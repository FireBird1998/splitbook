/**
 * What the Export page (#317) works out from the member's choices: the period's days, the
 * request it sends, the Groups picked to begin with, the currency note, and how a reply reads.
 */
import type { GroupRead } from '@splitbook/shared/group-read';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import {
  EXPORT_INCLUDES,
  isCalendarDay,
  localCalendarDay,
  monthWindow,
  type ExportInclude,
  type ExportRequest,
} from '@splitbook/shared/export-request';

/** "Period" is a date window, not the glossary's Month. */
export type ExportPeriod = 'this' | 'last' | 'custom' | 'all';

export const EXPORT_PERIODS: readonly ExportPeriod[] = ['this', 'last', 'custom', 'all'];

/** What a new export includes until the member changes it (the design's defaults). */
export const DEFAULT_INCLUDE: Readonly<Record<ExportInclude, boolean>> = {
  payments: true,
  shares: true,
  deleted: false,
  history: false,
};

export const INCLUDE_LABELS: Readonly<Record<ExportInclude, string>> = {
  payments: 'Payments',
  shares: 'Shares per person',
  deleted: 'Deleted Expenses',
  history: 'Edit history',
};

export interface PeriodOption {
  value: ExportPeriod;
  label: string;
  /** The days it covers, shown under the menu; none for a custom range. */
  hint: string | null;
}

const monthYear = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const shortMonth = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

/** A calendar month on the device's own calendar, counted from 1. */
function localMonth(now: Date, offset: number) {
  const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

/** "September 2026", and its days as "1–30 Sep 2026". */
function describeMonth({ year, month }: { year: number; month: number }) {
  const noon = Date.UTC(year, month - 1, 15, 12);
  const last = Number(monthWindow(year, month).to.slice(-2));
  return {
    name: monthYear.format(noon),
    days: `1–${last} ${shortMonth.format(noon)} ${year}`,
  };
}

/** The period menu, with this month and last month named as the device's calendar has them. */
export function periodOptions(now: Date): PeriodOption[] {
  const current = describeMonth(localMonth(now, 0));
  const previous = describeMonth(localMonth(now, -1));
  return [
    { value: 'this', label: `${current.name} (this month)`, hint: current.days },
    { value: 'last', label: `${previous.name} (last month)`, hint: previous.days },
    { value: 'custom', label: 'Custom range', hint: null },
    { value: 'all', label: 'All time', hint: 'Everything in each Group, from its first Expense' },
  ];
}

export interface CustomRange {
  from: string;
  to: string;
}

/** A custom range starts as this month so far. */
export function initialCustomRange(now: Date): CustomRange {
  const { year, month } = localMonth(now, 0);
  return { from: monthWindow(year, month).from, to: localCalendarDay(now) };
}

export type PeriodWindow = { from?: string; to?: string } | { error: string };

/** The days a period covers, or why a custom range can't be used yet. */
export function periodWindow(period: ExportPeriod, now: Date, custom: CustomRange): PeriodWindow {
  if (period === 'all') return {};
  if (period === 'this' || period === 'last') {
    const { year, month } = localMonth(now, period === 'this' ? 0 : -1);
    return monthWindow(year, month);
  }
  if (!isCalendarDay(custom.from) || !isCalendarDay(custom.to))
    return { error: 'Pick a start and an end date.' };
  if (custom.from > custom.to) return { error: 'The end date is before the start date.' };
  return { from: custom.from, to: custom.to };
}

/** A Group as the checklist shows it: its name, and its Theme and currency. */
export interface ExportGroupOption {
  id: string;
  name: string;
  meta: string;
  currency: string;
}

export function exportGroupOptions(groups: readonly GroupRead[]): ExportGroupOption[] {
  return groups.map((group) => ({
    id: group._id,
    name: group.name,
    meta: `${getGroupTheme(group.category).label} · ${group.defaultCurrency}`,
    currency: group.defaultCurrency,
  }));
}

/**
 * The Groups picked when the page opens: the one a Group's Export button named, or every
 * Group when the page was opened from the sidebar. A named Group the member isn't in picks
 * nothing, so nothing is exported that the link didn't ask for.
 */
export function initialSelection(
  groups: readonly ExportGroupOption[],
  preselected: string | null,
): string[] {
  if (preselected === null) return groups.map((group) => group.id);
  const match = groups.find((group) => group.id.toLowerCase() === preselected.toLowerCase());
  return match ? [match.id] : [];
}

/**
 * The request for the member's choices: the picked Groups in the list's order, the period's
 * days, what to include and the viewer's time zone. Null while no Group is picked or a custom
 * range is unfinished.
 */
export function exportRequest({
  groups,
  selected,
  window,
  include,
  timeZone,
}: {
  groups: readonly ExportGroupOption[];
  selected: readonly string[];
  window: PeriodWindow;
  include: Readonly<Record<ExportInclude, boolean>>;
  timeZone: string;
}): ExportRequest | null {
  if ('error' in window) return null;
  const groupIds = groups.filter((group) => selected.includes(group.id)).map((group) => group.id);
  if (groupIds.length === 0) return null;
  return {
    groupIds,
    ...window,
    include: EXPORT_INCLUDES.filter((name) => include[name]),
    format: 'csv',
    timeZone,
  };
}

/** "INR and EUR", for any number of codes. */
function joinCodes(codes: readonly string[]) {
  return codes.length < 2
    ? codes.join('')
    : `${codes.slice(0, -1).join(', ')} and ${codes[codes.length - 1]}`;
}

/** When the picked Groups use more than one currency, says each amount keeps its own. */
export function currencyNote(
  groups: readonly ExportGroupOption[],
  selected: readonly string[],
): string | null {
  const codes = [
    ...new Set(groups.filter((group) => selected.includes(group.id)).map((g) => g.currency)),
  ];
  if (codes.length < 2) return null;
  return `These Groups use ${joinCodes(codes)}. Each amount stays in its Group’s currency.`;
}

/** The file name a reply's `Content-Disposition` gives, if any. */
export function fileNameFromDisposition(header: string | null): string | null {
  const match = header ? /filename="([^"]+)"/.exec(header) : null;
  return match ? match[1] : null;
}

/**
 * What a refused or failed export says. The server's own message is shown only for a too-large
 * export, which says what to do; every other failure gets a fixed sentence.
 */
export function exportFailureMessage(status: number, body: unknown): string {
  const message = (body as { error?: unknown } | null)?.error;
  if (status === 413 && typeof message === 'string' && message) return message;
  if (status === 403)
    return 'You can only export Groups you’re in. Reload the page to see your Groups.';
  return 'The export couldn’t be prepared.';
}
